package app

enum class State { IDLE, RUNNING, DONE, FAILED, RETRYING }

object Registry {
    val jobs = mutableListOf<Job>()
}

class Job {
    private var state: State = State.IDLE

    fun start() {
        if (state != State.IDLE) return
        state = State.RUNNING
    }

    fun finish() {
        if (state == State.RUNNING) {
            state = State.DONE
        }
    }

    fun fail() {
        state = State.FAILED
    }

    fun describe(): String = when (state) {
        State.IDLE -> "waiting"
        State.RUNNING -> "busy"
        else -> "other"
    }
}
