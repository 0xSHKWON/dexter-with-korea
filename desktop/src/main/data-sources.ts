/**
 * Non-LLM API keys the agent core reads from process.env.
 * Env var names match the core exactly (src/utils/env.ts, CLAUDE.md activation rules).
 * The sidecar will decrypt these and inject them into the child process env.
 */
import type { DataSource } from '../shared/types';

export const DATA_SOURCES: DataSource[] = [
  // 한국 주식
  { envVar: 'DART_API_KEY', label: 'DART 전자공시', group: 'kr', note: '재무·공시·지배구조 등 5개 도구를 활성화 (opendart.fss.or.kr)' },
  { envVar: 'KRX_ID', label: 'KRX 아이디', group: 'kr', note: '공매도 순보유잔고 (data.krx.co.kr 로그인 계정)' },
  { envVar: 'KRX_PW', label: 'KRX 비밀번호', group: 'kr' },
  { envVar: 'DATA_GO_KR_SERVICE_KEY', label: '국민연금 (data.go.kr)', group: 'kr', note: 'Decoded(디코딩) 서비스키' },
  // 웹 검색
  { envVar: 'EXASEARCH_API_KEY', label: 'Exa', group: 'search' },
  { envVar: 'PERPLEXITY_API_KEY', label: 'Perplexity', group: 'search' },
  { envVar: 'TAVILY_API_KEY', label: 'Tavily', group: 'search' },
  { envVar: 'LANGSEARCH_API_KEY', label: 'LangSearch', group: 'search' },
  // 기타
  { envVar: 'X_BEARER_TOKEN', label: 'X (트위터)', group: 'other', note: '공개 트윗 감성 리서치' },
  { envVar: 'FINANCIAL_DATASETS_API_KEY', label: '미국 주식 데이터', group: 'other' },
];
