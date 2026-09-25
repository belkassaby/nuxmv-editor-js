package job

import "os"

type State int

const (
	Idle State = iota
	Running
	Done
	Failed
	Retrying
)

type Job struct {
	state State
}

func NewJob() *Job {
	return &Job{state: Idle}
}

func (j *Job) Start() {
	if j.state != Idle {
		return
	}
	j.state = Running
}

func (j *Job) Finish() {
	if j.state == Running {
		j.state = Done
	}
}

func (j *Job) Fail() {
	j.state = Failed
}

func (j *Job) Describe() string {
	switch j.state {
	case Idle:
		return "waiting"
	case Running:
		return "busy"
	case Done:
		return "finished"
	}
	return ""
}

func FirstByte(path string) (byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	buf := make([]byte, 1)
	if _, err = f.Read(buf); err != nil {
		return 0, err
	}
	f.Close()
	return buf[0], err
}
