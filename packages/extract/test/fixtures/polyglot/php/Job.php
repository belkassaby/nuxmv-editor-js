<?php

enum State { case Idle; case Running; case Done; case Failed; case Retrying; }

class Job {
    private State $state = State::Idle;

    public function start(): void {
        if ($this->state !== State::Idle) {
            return;
        }
        $this->state = State::Running;
    }

    public function finish(): void {
        if ($this->state === State::Running) {
            $this->state = State::Done;
        }
    }

    public function fail(): void {
        $this->state = State::Failed;
    }
}
