enum State { IDLE, RUNNING, DONE, FAILED, RETRYING }

class Job {
    State state = State.IDLE

    void start() {
        if (state != State.IDLE) return
        state = State.RUNNING
    }

    void finish() {
        if (state == State.RUNNING) {
            state = State.DONE
        }
    }

    void fail() {
        state = State.FAILED
    }

    String describe() {
        switch (state) {
            case State.IDLE: return 'waiting'
            case State.RUNNING: return 'busy'
            case State.DONE: return 'finished'
        }
        return ''
    }
}
