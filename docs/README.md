# Agent Mascot 문서 인덱스

> **2026-02-20**: 프로젝트를 웹 대시보드에서 데스크탑 마스코트 앱으로 전환.
> 기존 Office Dashboard 문서는 `archive/` 폴더로 이동 예정.

## Mascot 스펙 (신규)

| 문서 | 설명 |
|------|------|
| `mascot-product-spec.md` | 제품 개요, 사용자 시나리오, 화면 구성, 설계 원칙 |
| `mascot-architecture.md` | 시스템 아키텍처, 모듈 책임, 디렉토리 구조, 에러 처리 |
| `mascot-state-machine.md` | 상태 정의(9개), 전이 매트릭스, 타이머 전이, 애니메이션 매핑 |
| `mascot-spine-spec.md` | Spine 스켈레톤/스킨/애니메이션 요구사항, 외형 결정 알고리즘, 배치 규칙 |
| `mascot-ipc-protocol.md` | Tauri IPC 이벤트/명령 정의, 페이로드 타입, 초기화 시퀀스 |
| `mascot-hooks-integration.md` | Claude Code hooks 연동, 자동실행 로직, HTTP 엔드포인트 |

## Archive

`archive/` 폴더에는 이전 Office Dashboard 문서가 보존되어 있다.
핵심 내용(이벤트 스키마, Mulberry32 알고리즘 등)은 mascot-* 문서에 병합 완료.

## 문서 운영 원칙

- 코드 변경 시 관련 스펙을 함께 갱신한다.
- 하드코딩된 수치가 문서에 있으면 `config.toml` 참조로 변경한다.
- 결정 사항은 각 문서의 "결정 로그" 섹션에 날짜와 이유를 기록한다.
