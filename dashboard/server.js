/**
 * Claude Code Teams 실시간 모니터링 대시보드 서버
 * Node.js + Express + SSE (Server-Sent Events) 기반
 *
 * stream-json JSONL 형식 지원:
 * - .json 파일을 position tracking으로 새 줄 읽기
 * - content_block_start/delta/stop 이벤트 파싱
 * - type:result 줄로 완료 처리
 */

import express from 'express';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, relative, sep } from 'path';
import chokidar from 'chokidar';

// ============================================================
// 경로 설정
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 프로젝트 루트: dashboard/ 의 상위 디렉토리
const PROJECT_ROOT = dirname(__dirname);
const LOGS_DIR = join(PROJECT_ROOT, 'logs');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates');
const WORKSPACE_DIR = join(PROJECT_ROOT, 'workspace');
const PUBLIC_DIR = join(__dirname, 'public');

// logs 디렉토리가 없으면 생성
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

// workspace 디렉토리가 없으면 생성
if (!existsSync(WORKSPACE_DIR)) {
  mkdirSync(WORKSPACE_DIR, { recursive: true });
}

const PORT = process.env.PORT || 4000;

// ============================================================
// 전역 상태 관리
// ============================================================

/**
 * 전체 애플리케이션 상태
 * runs: 실행 중인 팀 세션들
 * recentFiles: 최근 파일 활동 목록
 */
const state = {
  runs: {},
  recentFiles: [],
};

// SSE 클라이언트 목록
const clients = new Set();

// 파일 읽기 위치 추적 (position tracking)
// key: 파일 경로, value: 마지막으로 읽은 문자 수 (문자열 기준)
const filePositions = new Map();

// JSONL 파싱 상태 추적
// key: 파일 경로, value: { pendingLine: string }
const jsonlStates = new Map();

// 에이전트별 블록 처리 상태
// key: "runId/memberName", value: AgentParseState
const agentParseStates = new Map();

// ============================================================
// SSE 유틸리티
// ============================================================

/**
 * 모든 연결된 SSE 클라이언트에게 이벤트 전송
 * @param {string} event - 이벤트 타입
 * @param {object} data - 전송할 데이터
 */
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(message);
    } catch {
      // 끊어진 클라이언트 제거
      clients.delete(client);
    }
  }
}

/**
 * 특정 클라이언트에게 이벤트 전송
 * @param {object} res - Express response 객체
 * @param {string} event - 이벤트 타입
 * @param {object} data - 전송할 데이터
 */
function sendToClient(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // 전송 실패 무시
  }
}

// ============================================================
// 실행 디렉토리 파싱
// ============================================================

/**
 * 로그 디렉토리명에서 실행 정보 파싱
 * 형식: YYYYMMDD-HHMMSS-templatename
 * @param {string} dirName - 디렉토리명
 * @returns {{ runId: string, timestamp: string, template: string }|null}
 */
function parseRunDir(dirName) {
  const match = dirName.match(/^(\d{8}-\d{6})-(.+)$/);
  if (!match) return null;

  const [, timestamp, template] = match;
  return { runId: dirName, timestamp, template };
}

/**
 * 템플릿 JSON 파일 로드
 * @param {string} templateName - 템플릿명
 * @returns {object|null} - 템플릿 데이터 또는 null
 */
function loadTemplate(templateName) {
  const templatePath = join(TEMPLATES_DIR, `${templateName}.json`);
  try {
    const content = readFileSync(templatePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[경고] 템플릿 파일 로드 실패: ${templatePath} - ${err.message}`);
    return null;
  }
}

/**
 * 새 실행 세션 초기화 및 상태 등록
 * @param {string} runDir - 실행 디렉토리 전체 경로
 */
async function initRun(runDir) {
  const dirName = runDir.split(sep).pop();
  const parsed = parseRunDir(dirName);
  if (!parsed) return;

  const { runId, timestamp, template } = parsed;

  // 이미 등록된 실행이면 스킵
  if (state.runs[runId]) return;

  console.log(`[정보] 새 실행 감지: ${runId}`);

  // 템플릿 로드
  const templateData = loadTemplate(template);
  const displayName = templateData?.display_name || template;

  // 멤버 목록 구성 (확장된 agent state 구조)
  const members = {};
  if (templateData?.members) {
    for (const member of templateData.members) {
      members[member.name] = createMemberState(member.display_name, member.role);
    }
  }

  // 상태 등록
  state.runs[runId] = {
    template,
    displayName,
    timestamp,
    members,
  };

  // 클라이언트에게 새 실행 알림
  broadcast('run:start', {
    runId,
    template,
    displayName,
    timestamp,
    members,
  });

  // 이미 존재하는 .status 파일 처리 (이전 실행 재로드 시)
  const statusPath = join(runDir, '.status');
  if (existsSync(statusPath)) {
    await processStatusFile(statusPath, runId);
  }
}

/**
 * 에이전트 초기 상태 객체 생성
 * @param {string} displayName - 표시 이름
 * @param {string} role - 역할
 * @returns {object} 에이전트 상태 객체
 */
function createMemberState(displayName, role) {
  return {
    displayName,
    role,
    status: 'waiting',         // waiting | thinking | using_tool | done | error
    currentAction: '',          // "📝 server.js 생성 중..." 형태
    toolCalls: [],              // 최근 20개: {tool, summary, timestamp}
    thinkingBuffer: '',         // 현재 축적 중인 사고 텍스트
    thinkingPreview: '',        // 최근 완성된 사고 텍스트 (최대 100자)
    turn: 0,
    fileCount: 0,
    startTime: null,            // ISO 타임스탬프
    endTime: null,
    totalCost: 0,
  };
}

// ============================================================
// tool 호출 친화적 메시지 생성
// ============================================================

/**
 * tool_use content_block 의 input JSON을 받아 사람이 읽기 좋은 메시지 생성
 * @param {string} toolName - 도구 이름
 * @param {object} input - 도구 입력 JSON
 * @returns {string} 친화적 메시지
 */
function formatToolCall(toolName, input) {
  try {
    switch (toolName) {
      case 'Write': {
        const fileName = input?.file_path ? input.file_path.split('/').pop() : '?';
        return `📝 ${fileName} 생성`;
      }
      case 'Edit': {
        const fileName = input?.file_path ? input.file_path.split('/').pop() : '?';
        return `✏️ ${fileName} 수정`;
      }
      case 'Read': {
        const fileName = input?.file_path ? input.file_path.split('/').pop() : '?';
        return `📖 ${fileName} 읽기`;
      }
      case 'Bash': {
        const cmd = (input?.command || '').slice(0, 60);
        return `⚡ ${cmd}`;
      }
      default:
        return `🔧 ${toolName}`;
    }
  } catch {
    return `🔧 ${toolName}`;
  }
}

// ============================================================
// JSONL 스트림 이벤트 처리 (stream-json 형식)
// ============================================================

/**
 * 에이전트의 JSONL 파싱 상태를 가져오거나 초기화
 * @param {string} key - "runId/memberName"
 * @returns {object} 파싱 상태
 */
function getAgentParseState(key) {
  if (!agentParseStates.has(key)) {
    agentParseStates.set(key, {
      // index별 블록 정보: { type: 'text'|'tool_use', name: string, partialJson: string }
      blocks: new Map(),
    });
  }
  return agentParseStates.get(key);
}

/**
 * stream-json JSONL 이벤트 한 줄 처리
 * @param {object} parsed - 파싱된 JSON 객체
 * @param {string} runId - 실행 ID
 * @param {string} memberName - 에이전트 이름
 */
function handleStreamEvent(parsed, runId, memberName) {
  const run = state.runs[runId];
  if (!run) return;

  const member = run.members[memberName];
  if (!member) return;

  const stateKey = `${runId}/${memberName}`;

  // ── type: result → 완료 처리 ──────────────────────────────
  if (parsed.type === 'result') {
    const isError = parsed.is_error === true;
    member.status = isError ? 'error' : 'done';
    member.endTime = new Date().toISOString();
    member.totalCost = parsed.total_cost_usd || 0;
    member.currentAction = isError ? '오류 발생' : '완료';

    broadcast('agent:status', {
      runId,
      name: memberName,
      status: member.status,
      turn: member.turn,
    });
    broadcast('agent:done', {
      runId,
      name: memberName,
      isError,
      totalCost: member.totalCost,
      durationMs: parsed.duration_ms,
    });

    console.log(`[정보] 에이전트 ${isError ? '오류' : '완료'}: ${runId} / ${memberName} (비용: $${member.totalCost})`);
    return;
  }

  // ── type: stream_event 처리 ───────────────────────────────
  if (parsed.type !== 'stream_event') return;

  const evt = parsed.event;
  if (!evt) return;

  const parseState = getAgentParseState(stateKey);

  switch (evt.type) {
    // 블록 시작
    case 'content_block_start': {
      const idx = evt.index;
      const block = evt.content_block;
      if (!block) break;

      if (block.type === 'text') {
        // 텍스트 블록 시작: thinking 상태로 전환
        parseState.blocks.set(idx, { type: 'text', partialText: '' });

        if (member.status !== 'thinking') {
          member.status = 'thinking';
          member.thinkingBuffer = '';
          broadcast('agent:status', {
            runId,
            name: memberName,
            status: 'thinking',
            turn: member.turn,
          });
        }
        // startTime 최초 설정
        if (!member.startTime) {
          member.startTime = new Date().toISOString();
        }

      } else if (block.type === 'tool_use') {
        // tool_use 블록 시작: tool 사용 상태로 전환
        parseState.blocks.set(idx, {
          type: 'tool_use',
          name: block.name || '',
          partialJson: '',
        });

        member.status = 'using_tool';
        member.currentAction = `🔧 ${block.name || ''}`;
        broadcast('agent:status', {
          runId,
          name: memberName,
          status: 'using_tool',
          turn: member.turn,
        });
      }
      break;
    }

    // 블록 델타 (내용 추가)
    case 'content_block_delta': {
      const idx = evt.index;
      const delta = evt.delta;
      if (!delta) break;

      const blockInfo = parseState.blocks.get(idx);
      if (!blockInfo) break;

      if (blockInfo.type === 'text' && delta.type === 'text_delta') {
        // 텍스트 누적 및 thinking 이벤트 발송
        const text = delta.text || '';
        blockInfo.partialText += text;
        member.thinkingBuffer += text;

        // thinking preview 업데이트 (100자 이내)
        const preview = member.thinkingBuffer.slice(-100);
        member.thinkingPreview = preview;

        broadcast('agent:thinking', {
          runId,
          name: memberName,
          text,
        });

      } else if (blockInfo.type === 'tool_use' && delta.type === 'input_json_delta') {
        // tool_use input JSON 누적 (partial_json 조각들을 이어붙임)
        blockInfo.partialJson += delta.partial_json || '';
      }
      break;
    }

    // 블록 종료
    case 'content_block_stop': {
      const idx = evt.index;
      const blockInfo = parseState.blocks.get(idx);
      if (!blockInfo) break;

      if (blockInfo.type === 'text') {
        // 텍스트 블록 완료 → thinkingPreview 확정
        const completed = blockInfo.partialText;
        if (completed.trim()) {
          member.thinkingPreview = completed.slice(-100);
        }
        member.thinkingBuffer = '';

      } else if (blockInfo.type === 'tool_use') {
        // tool_use 블록 완료 → 누적된 JSON 파싱 후 메시지 생성
        let inputObj = {};
        try {
          if (blockInfo.partialJson) {
            inputObj = JSON.parse(blockInfo.partialJson);
          }
        } catch {
          // JSON 파싱 실패 시 빈 객체 유지
        }

        const toolName = blockInfo.name;
        const summary = formatToolCall(toolName, inputObj);

        // currentAction 업데이트
        member.currentAction = summary;

        // toolCalls 기록 (최근 20개 유지)
        const toolEntry = {
          tool: toolName,
          summary,
          timestamp: new Date().toISOString(),
        };
        member.toolCalls.push(toolEntry);
        if (member.toolCalls.length > 20) {
          member.toolCalls.shift();
        }

        // 파일 관련 도구는 fileCount 증가
        if (toolName === 'Write' || toolName === 'Edit') {
          member.fileCount++;
        }

        // turn 카운터 증가
        member.turn++;

        broadcast('agent:tool_call', {
          runId,
          name: memberName,
          tool: toolName,
          summary,
          timestamp: toolEntry.timestamp,
        });
        broadcast('agent:status', {
          runId,
          name: memberName,
          status: 'using_tool',
          turn: member.turn,
        });
      }

      // 처리 완료된 블록 정보 삭제
      parseState.blocks.delete(idx);
      break;
    }

    // message_stop: 한 턴 응답 완료
    case 'message_stop': {
      // 다음 입력 대기 상태가 될 때까지 thinking 상태 유지
      // (특별한 처리 불필요 - result 줄이 최종 완료 신호)
      break;
    }

    default:
      // 그 외 이벤트는 무시
      break;
  }
}

// ============================================================
// JSONL 파일 처리 (증가분만 읽기)
// ============================================================

/**
 * stream-json JSONL 파일에서 새로 추가된 줄만 읽어 이벤트 처리
 * position tracking으로 이미 읽은 부분은 건너뜀
 * @param {string} filePath - .json 파일 경로
 */
async function processJsonlFile(filePath) {
  try {
    // 파일 경로에서 runId와 memberName 추출
    const relativePath = relative(LOGS_DIR, filePath);
    const parts = relativePath.split(sep);
    if (parts.length < 2) return;

    const runId = parts[0];
    const fileName = parts[1];

    // .json 파일만 처리
    if (!fileName.endsWith('.json')) return;

    const memberName = fileName.replace('.json', '');
    const run = state.runs[runId];
    if (!run) return;

    // 멤버가 없으면 동적으로 추가 (템플릿 미매칭 에이전트 대응)
    if (!run.members[memberName]) {
      run.members[memberName] = createMemberState(memberName, '');
    }
    const member = run.members[memberName];

    // 파일 전체 내용 읽기 (UTF-8 문자열 기준)
    const content = await readFile(filePath, 'utf-8');

    // 현재까지 읽은 문자 수
    const currentPos = filePositions.get(filePath) || 0;
    const newContent = content.slice(currentPos);

    if (!newContent) return;

    // 다음 읽기 위치 업데이트
    filePositions.set(filePath, content.length);

    // 이전 읽기에서 잘린 불완전한 줄 복원
    const jsonlKey = filePath;
    if (!jsonlStates.has(jsonlKey)) {
      jsonlStates.set(jsonlKey, { pendingLine: '' });
    }
    const jsonlState = jsonlStates.get(jsonlKey);

    // 이전 미완성 줄 + 새 내용 합치기
    const combined = jsonlState.pendingLine + newContent;
    const lines = combined.split('\n');

    // 마지막 줄이 불완전할 수 있으므로 보류
    // (개행으로 끝나지 않으면 마지막 줄은 다음 번에 처리)
    const lastLine = lines[lines.length - 1];
    jsonlState.pendingLine = combined.endsWith('\n') ? '' : lastLine;

    // 완전한 줄들만 처리 (마지막 줄 제외, 단 개행으로 끝난 경우 포함)
    const completeLines = combined.endsWith('\n') ? lines.slice(0, -1) : lines.slice(0, -1);

    for (const line of completeLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // JSON 파싱 시도
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // 파싱 실패 줄은 조용히 스킵
        continue;
      }

      // 처음 내용이 감지되면 waiting → thinking 으로 상태 변경 알림
      if (member.status === 'waiting') {
        member.status = 'thinking';
        member.startTime = new Date().toISOString();
        broadcast('agent:status', {
          runId,
          name: memberName,
          status: 'thinking',
          turn: member.turn,
        });
      }

      // 스트림 이벤트 처리
      handleStreamEvent(parsed, runId, memberName);
    }

  } catch (err) {
    // 파일이 아직 없거나 읽기 실패 시 무시
    if (err.code !== 'ENOENT') {
      console.warn(`[경고] JSONL 파일 읽기 실패: ${filePath} - ${err.message}`);
    }
  }
}

// ============================================================
// .status 파일 처리 (백업 완료 감지)
// ============================================================

/**
 * .status 파일에서 완료된 팀원 정보 파싱
 * stream-json result 줄이 없을 때의 백업 완료 감지 수단
 * @param {string} filePath - .status 파일 경로
 * @param {string} runId - 실행 ID
 */
async function processStatusFile(filePath, runId) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const run = state.runs[runId];
    if (!run) return;

    for (const line of lines) {
      // "memberName 완료" 패턴 파싱
      const match = line.match(/^(\S+)\s+완료$/);
      if (!match) continue;

      const memberName = match[1];
      const member = run.members[memberName];
      if (!member) continue;

      // 이미 stream-json result로 완료 처리된 경우 스킵
      if (member.status === 'done' || member.status === 'error') continue;

      member.status = 'done';
      broadcast('agent:status', {
        runId,
        name: memberName,
        status: 'done',
        turn: member.turn,
      });
      broadcast('agent:done', {
        runId,
        name: memberName,
        isError: false,
      });

      console.log(`[정보] 에이전트 완료 (.status): ${runId} / ${memberName}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[경고] .status 파일 읽기 실패: ${filePath} - ${err.message}`);
    }
  }
}

// ============================================================
// workspace 파일 감시
// ============================================================

/**
 * workspace 파일 변경 이벤트 처리
 * @param {string} filePath - 변경된 파일 경로
 * @param {string} eventType - 이벤트 타입 ('add' | 'change')
 */
function processWorkspaceFile(filePath, eventType) {
  const relativePath = relative(WORKSPACE_DIR, filePath);
  const parts = relativePath.split(sep);
  if (parts.length < 2) return;

  const memberName = parts[0];

  // shared 폴더는 특정 멤버에 귀속하지 않음
  const actualMemberName = memberName === 'shared' ? 'shared' : memberName;

  // 현재 활성 실행 찾기 (가장 최근 실행, 타임스탬프 기준)
  const runIds = Object.keys(state.runs);
  if (runIds.length === 0) return;

  const latestRunId = runIds.sort().pop();

  // 파일 카운터 증가 (shared가 아닌 경우)
  if (memberName !== 'shared') {
    const run = state.runs[latestRunId];
    if (run?.members[memberName]) {
      run.members[memberName].fileCount++;
    }
  }

  // 최근 파일 목록 업데이트 (최대 30개)
  const fileEntry = {
    path: relativePath,
    type: eventType,
    time: new Date().toISOString(),
    memberName: actualMemberName,
  };

  state.recentFiles.unshift(fileEntry);
  if (state.recentFiles.length > 30) {
    state.recentFiles.pop();
  }

  // 클라이언트에게 파일 변경 알림
  broadcast('file:change', {
    runId: latestRunId,
    memberName: actualMemberName,
    path: relativePath,
    type: eventType,
  });
}

// ============================================================
// chokidar 감시 설정
// ============================================================

/**
 * logs/ 디렉토리 감시
 * - 새 실행 디렉토리 감지 (addDir)
 * - .json JSONL 파일 변경 감지 (add, change)
 * - .status 파일 변경 감지 (add, change) - 백업 완료 감지용
 */
const logsWatcher = chokidar.watch(LOGS_DIR, {
  persistent: true,
  ignoreInitial: false,  // 서버 시작 시 기존 실행도 감지
  depth: 2,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 50,
  },
});

logsWatcher
  .on('addDir', async (dirPath) => {
    // logs/ 자체는 무시
    if (dirPath === LOGS_DIR) return;

    // logs/runId 레벨의 디렉토리만 처리 (하위 디렉토리 무시)
    const relativePath = relative(LOGS_DIR, dirPath);
    if (relativePath.includes(sep)) return;

    await initRun(dirPath);
  })
  .on('add', async (filePath) => {
    const relativePath = relative(LOGS_DIR, filePath);
    const parts = relativePath.split(sep);
    if (parts.length !== 2) return;

    const runId = parts[0];
    const fileName = parts[1];

    if (fileName.endsWith('.json')) {
      // runId가 아직 등록되지 않은 경우 초기화 먼저
      if (!state.runs[runId]) {
        await initRun(join(LOGS_DIR, runId));
      }
      await processJsonlFile(filePath);
    } else if (fileName === '.status') {
      // runId가 아직 등록되지 않은 경우 초기화 먼저
      if (!state.runs[runId]) {
        await initRun(join(LOGS_DIR, runId));
      }
      await processStatusFile(filePath, runId);
    }
  })
  .on('change', async (filePath) => {
    const relativePath = relative(LOGS_DIR, filePath);
    const parts = relativePath.split(sep);
    if (parts.length !== 2) return;

    const runId = parts[0];
    const fileName = parts[1];

    if (fileName.endsWith('.json')) {
      await processJsonlFile(filePath);
    } else if (fileName === '.status') {
      await processStatusFile(filePath, runId);
    }
  })
  .on('error', (err) => {
    console.error(`[오류] logs 감시 오류: ${err.message}`);
  });

/**
 * workspace/ 디렉토리 감시
 * - 파일 생성/변경 이벤트 감지
 */
const workspaceWatcher = chokidar.watch(WORKSPACE_DIR, {
  persistent: true,
  ignoreInitial: true,  // 기존 파일은 무시 (새로 생성되는 파일만 추적)
  depth: 10,
  awaitWriteFinish: {
    stabilityThreshold: 500,
    pollInterval: 100,
  },
  ignored: [/node_modules/, /\.git/],
});

workspaceWatcher
  .on('add', (filePath) => {
    processWorkspaceFile(filePath, 'add');
  })
  .on('change', (filePath) => {
    processWorkspaceFile(filePath, 'change');
  })
  .on('error', (err) => {
    console.error(`[오류] workspace 감시 오류: ${err.message}`);
  });

// ============================================================
// Express 서버 설정
// ============================================================
const app = express();

// 정적 파일 서빙 (dashboard/public/)
app.use(express.static(PUBLIC_DIR));

/**
 * SSE 엔드포인트
 * 클라이언트 연결 시 현재 상태 스냅샷 전송 후 실시간 이벤트 스트리밍
 */
app.get('/events', (req, res) => {
  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // nginx 프록시 버퍼링 비활성화
  res.flushHeaders();

  // 연결 확인용 초기 코멘트 (SSE 규격)
  res.write(': connected\n\n');

  // 현재 전체 상태 스냅샷 전송 (클라이언트 초기화용)
  sendToClient(res, 'state', {
    runs: state.runs,
    recentFiles: state.recentFiles,
  });

  // 클라이언트 등록
  clients.add(res);
  console.log(`[정보] SSE 클라이언트 연결 (총 ${clients.size}명)`);

  // 30초마다 keepalive ping 전송 (연결 유지)
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 30000);

  // 클라이언트 연결 종료 시 정리
  req.on('close', () => {
    clients.delete(res);
    clearInterval(keepAlive);
    console.log(`[정보] SSE 클라이언트 연결 종료 (총 ${clients.size}명)`);
  });
});

/**
 * 현재 전체 상태 스냅샷 API
 * 대시보드 초기 로드 또는 재연결 시 사용
 */
app.get('/api/state', (req, res) => {
  res.json({
    runs: state.runs,
    recentFiles: state.recentFiles,
  });
});

/**
 * 사용 가능한 템플릿 목록 API
 */
app.get('/api/templates', (req, res) => {
  const templates = [];
  try {
    if (existsSync(TEMPLATES_DIR)) {
      const files = readdirSync(TEMPLATES_DIR);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
          const data = JSON.parse(content);
          templates.push({
            name: data.name || file.replace('.json', ''),
            displayName: data.display_name || data.name,
            description: data.description || '',
          });
        } catch {
          // JSON 파싱 실패 시 해당 파일 스킵
        }
      }
    }
  } catch (err) {
    console.warn(`[경고] 템플릿 목록 로드 실패: ${err.message}`);
  }
  res.json({ templates });
});

// ============================================================
// 서버 시작
// ============================================================
app.listen(PORT, () => {
  console.log('');
  console.log('=================================================');
  console.log('  Claude Code Teams 모니터링 대시보드');
  console.log('=================================================');
  console.log(`  URL:          http://localhost:${PORT}`);
  console.log(`  프로젝트:     ${PROJECT_ROOT}`);
  console.log(`  로그:         ${LOGS_DIR}`);
  console.log(`  워크스페이스: ${WORKSPACE_DIR}`);
  console.log('=================================================');
  console.log('');
});
