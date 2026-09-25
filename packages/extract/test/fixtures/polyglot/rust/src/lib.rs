pub enum State {
    Idle,
    Running,
    Done,
    Failed,
    Retrying,
}

pub struct Job {
    state: State,
}

impl Job {
    pub fn new() -> Self {
        Job { state: State::Idle }
    }

    pub fn start(&mut self) {
        if let State::Idle = self.state {
            self.state = State::Running;
        }
    }

    pub fn finish(&mut self) {
        match self.state {
            State::Running => self.state = State::Done,
            _ => {}
        }
    }

    pub fn fail(&mut self) {
        self.state = State::Failed;
    }
}
