# Performance Targets

## 1. 목표
사용자가 "느리다"고 느끼지 않도록 반응성 지표를 명확히 정의하고 측정한다.

## 2. SLO (MVP)
- 이벤트 반영 지연 (ingest -> UI 반영)
  - p50 <= 300ms
  - p95 <= 800ms
  - p99 <= 1500ms
- 오피스 탭 렌더링
  - 20 agents 기준 평균 FPS >= 30
  - 8 agents 기준 평균 FPS >= 50
- 대시보드 탭 상호작용
  - 필터 적용 응답 <= 200ms (최근 1,000 이벤트 기준)

## 3. 용량 목표
- 동시 에이전트: 20 (MVP)
- 이벤트 처리량: 50 events/sec burst
- 동시 WebSocket 클라이언트: 10

## 4. 측정 지표
- 서버
  - ingest latency
  - validation latency
  - broadcast fanout latency
  - queue depth
- 클라이언트
  - frame time
  - dropped frame 비율
  - event apply latency

## 5. 측정 방법
- 서버 측
  - 이벤트 수신 시각 `t_ingest`
  - broadcast 직전 `t_emit`
- 클라이언트 측
  - 메시지 수신 시각 `t_recv`
  - 상태 적용 완료 `t_apply`
  - 렌더 완료 `t_render`
- 총 지연: `t_render - t_ingest`

## 6. 성능 예산 (초안)
- 수신+검증: 50ms
- 저장: 80ms
- 브로드캐스트: 70ms
- 클라이언트 적용: 80ms
- 렌더 반영: 120ms
- 합계: 약 400ms (p50 목표)

## 7. 최적화 전략
- 서버
  - ingest와 저장을 분리(비동기 큐)
  - JSON 직렬화 최소화
  - 배치 flush(저장소별)
- 클라이언트
  - Canvas/Pixi 사용
  - React 리렌더 최소화(상태 분리)
  - 애니메이션은 requestAnimationFrame 기반

## 8. 성능 저하 대응 순서
1. 이벤트 로그 렌더 개수 제한(가상화)
2. 오피스 탭 시각 효과 축소
3. update tick 간격 완화
4. 이벤트 샘플링(비핵심 타입)

## 9. 수용 테스트
- 시나리오 A: 8 agents, 10 events/sec, 10분 연속
- 시나리오 B: 20 agents, 50 events/sec burst 30초
- 시나리오 C: ws 재연결 반복 100회

통과 기준:
- 크래시 0건
- p95 지연 목표 충족
- 오피스 탭 FPS 목표 충족
