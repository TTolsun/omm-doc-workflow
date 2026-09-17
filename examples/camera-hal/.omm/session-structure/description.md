CaptureSession.h의 CaptureSession은 BufferSlot을 kBufferLimit(4)개 배열로 소유하고, 처리 중인 요청 수를 inFlight_에 셉니다. submit은 RequestQueue.h의 canAccept로 수용 여부를 먼저 확인합니다.
