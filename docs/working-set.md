# Working Set

코딩 작업 시작 시 이 5개 문서만 먼저 본다.

1. `product-spec.md`
- 무엇을 만들지(기능/범위)

2. `system-architecture.md`
- 어디에 구현할지(API, 저장, 스트림)

3. `event-schema.md`
- 데이터 계약(필드/타입/검증)

4. `state-machine.md`
- Office 탭 상태 전이/연출 규칙

5. `implementation-plan.md`
- 현재 구현 순서와 체크리스트

## 작업 규칙
- 코드 변경 전, 위 5개와 충돌 여부를 먼저 확인한다.
- 충돌 시 코드보다 문서를 먼저 정정하고 이유를 남긴다.
- 기능 상세가 필요하면 Feature Specs를 추가로 연다.
