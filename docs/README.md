# Agent Office Dashboard 문서 인덱스

이 폴더는 **현재 코드와 직접 연결되는 문서만** 유지한다.
완료된 실행 계획, 아카이브 분석본, 샘플 payload 묶음은 제거했다.

## 1) 제품/아키텍처 기준
- `product-spec.md`: 제품 목표/범위
- `system-architecture.md`: 시스템 구성/흐름
- `event-schema.md`: 수집 이벤트 계약
- `state-machine.md`: 상태 전이 규칙
- `settings-spec.md`: 설정 스키마/기본값

## 2) 화면/도메인 스펙
- `office-layout-spec.md`: 오피스 레이아웃 기준
- `office-behavior-spec.md`: 상태별 연출 규칙
- `agents-tab-spec.md`: Agents 탭 정보 구조
- `session-routing.md`: 세션/터미널 스코프 라우팅
- `time-travel-spec.md`: 이벤트 컨텍스트 조회 기준
- `character-appearance-spec.md`: 캐릭터 외형 생성 규칙
- `ui-art-direction.md`: UI 아트 방향
- `performance-targets.md`: 성능 목표

## 3) 운영 문서
- `hooks-quickstart.md`: Hook 연동 최소 설정
- `global-hooks-template.json`: 전역 hooks 병합 템플릿

## 4) 코드 진단/개선
- `코드베이스-진단-개선-리포트.md`: 구조적 문제, UI 미연결 항목, 레거시, 개선 우선순위

## 문서 운영 원칙
- 코드 변경 시 관련 스펙을 함께 갱신한다.
- 신규 문서는 "현재 코드 동작을 설명/검증하는 목적"일 때만 추가한다.
- 완료된 실행 계획/검토 로그/임시 분석은 재사용 가치가 없으면 남기지 않는다.
