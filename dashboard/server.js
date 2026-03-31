/**
 * Claude Code Teams 실시간 모니터링 대시보드 서버
 * Node.js + Express + SSE (Server-Sent Events) 기반
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
// key: 파일 경로, value: 마지막으로 읽은 바이트 수
const filePositions = new Map();

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

  // 멤버 목록 구성
  const members = {};
  if (templateData?.members) {
    for (const member of templateData.members) {
      members[member.name] = {
        displayName: member.display_name,
        role: member.role,
        status: 'waiting',
        logs: [],
        fileCount: 0,
      };
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

// ============================================================
// 로그 파일 처리 (증가분만 읽기)
// ============================================================

/**
 * txt 로그 파일에서 새로 추가된 내용만 읽어 SSE 전송
 * position tracking으로 이미 읽은 부분은 건너뜀
 * @param {string} filePath - 로그 파일 경로
 */
async function processLogFile(filePath) {
  try {
    // 파일 경로에서 runId와 memberName 추출
    const relativePath = relative(LOGS_DIR, filePath);
    const parts = relativePath.split(sep);
    if (parts.length < 2) return;

    const runId = parts[0];
    const fileName = parts[1];

    // .txt 파일만 처리
    if (!fileName.endsWith('.txt')) return;

    const memberName = fileName.replace('.txt', '');
    const run = state.runs[runId];
    if (!run) return;

    const member = run.members[memberName];
    if (!member) return;

    // 파일 전체 내용 읽기
    const content = await readFile(filePath, 'utf-8');

    // 현재까지 읽은 문자 수 (UTF-8 문자열 기준)
    const currentPos = filePositions.get(filePath) || 0;
    const newContent = content.slice(currentPos);

    if (!newContent) return;

    // 다음 읽기 위치 업데이트
    filePositions.set(filePath, content.length);

    // 처음 새 내용이 감지되면 실행 중 상태로 변경
    if (currentPos === 0 && newContent.trim()) {
      if (member.status === 'waiting') {
        member.status = 'running';
        broadcast('agent:status', { runId, name: memberName, status: 'running' });
      }
    }

    // 줄 단위로 분리하여 각 줄을 이벤트로 전송
    const lines = newContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 상태에 최근 100줄만 유지
      member.logs.push(trimmed);
      if (member.logs.length > 100) {
        member.logs.shift();
      }

      broadcast('agent:log', { runId, name: memberName, line: trimmed });
    }
  } catch (err) {
    // 파일이 아직 없거나 읽기 실패 시 무시
    if (err.code !== 'ENOENT') {
      console.warn(`[경고] 로그 파일 읽기 실패: ${filePath} - ${err.message}`);
    }
  }
}

// ============================================================
// .status 파일 처리
// ============================================================

/**
 * .status 파일에서 완료된 팀원 정보 파싱
 * 형식: "memberName 완료" (한 줄씩)
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

      // 이미 완료 처리된 경우 스킵
      if (member.status === 'done') continue;

      member.status = 'done';
      broadcast('agent:status', { runId, name: memberName, status: 'done' });
      broadcast('agent:done', { runId, name: memberName });

      console.log(`[정보] 에이전트 완료: ${runId} / ${memberName}`);
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
 * - .txt 로그 파일 변경 감지 (add, change)
 * - .status 파일 변경 감지 (add, change)
 */
const logsWatcher = chokidar.watch(LOGS_DIR, {
  persistent: true,
  ignoreInitial: false,  // 서버 시작 시 기존 실행도 감지
  depth: 2,
  awaitWriteFinish: {
    stabilityThreshold: 300,
    pollInterval: 100,
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

    if (fileName.endsWith('.txt')) {
      await processLogFile(filePath);
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

    if (fileName.endsWith('.txt')) {
      await processLogFile(filePath);
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
