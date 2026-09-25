export interface TrafficLight {
    next(): TrafficLight;
}

export class Red implements TrafficLight {
    next(): TrafficLight {
        return new Green();
    }
}

export class Green implements TrafficLight {
    next(): TrafficLight {
        return new Yellow();
    }
}

export class Yellow implements TrafficLight {
    next(): TrafficLight {
        return new Red();
    }
}

export class Broken implements TrafficLight {
    next(): TrafficLight {
        return new Broken();
    }
}

export const start: TrafficLight = new Red();
