class Job
  def initialize
    @state = :queued
  end

  def start
    return unless @state == :queued
    @state = :running
  end

  def finish
    @state = :done if @state == :running
  end

  def fail
    @state = :failed
  end

  def describe
    case @state
    when :queued then "waiting"
    when :running then "busy"
    when :retrying then "again"
    end
  end
end
