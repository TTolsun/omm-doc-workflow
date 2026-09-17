BufferSlot.cpp의 상태는 Free, Queued, InFlight 세 가지입니다. reserve는 Free에서만, submit은 Queued에서만, release는 InFlight에서만 상태를 바꾸고 true를 반환하며, 다른 상태에서는 상태를 유지하고 false를 반환합니다.
