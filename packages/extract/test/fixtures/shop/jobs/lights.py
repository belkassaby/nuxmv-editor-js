from transitions import Machine


class Lamp:
    def __init__(self):
        self.machine = Machine(model=self, states=["off", "on", "broken"], initial="off",
                               transitions=[["switch_on", "off", "on"], ["switch_off", "on", "off"], ["smash", "*", "broken"]])
