---
based_on: [request-flow]
confidence: code
sources:
  - RequestQueue.h#kBufferLimit
  - RequestQueue.cpp#canAccept
decisions: []
verifications: []
---
canAccept는 처리 중인 버퍼 수가 4보다 작을 때 true를 반환합니다. 4 이상이면 false를 반환합니다. 경곗값은 RequestQueue.h의 kBufferLimit에 정의되어 있습니다.
