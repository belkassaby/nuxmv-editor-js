package app

sealed trait State
case object Idle extends State
case object Running extends State
case object Done extends State
case object Failed extends State
case object Retrying extends State

class Job {
  private var state: State = Idle

  def start(): Unit = {
    if (state != Idle) return
    state = Running
  }

  def finish(): Unit = {
    if (state == Running) state = Done
  }

  def fail(): Unit = {
    state = Failed
  }
}
