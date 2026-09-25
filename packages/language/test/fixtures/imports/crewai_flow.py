from crewai.flow.flow import Flow, listen, router, start

class ContentFlow(Flow):
    @start()
    def draft(self):
        return "draft"

    @router(draft)
    def review(self):
        if self.state.score > 0.8:
            return "approved"
        return "rejected"

    @listen("approved")
    def publish(self):
        pass

    @listen("rejected")
    def revise(self):
        pass

    @listen(revise)
    def redraft(self):
        pass
