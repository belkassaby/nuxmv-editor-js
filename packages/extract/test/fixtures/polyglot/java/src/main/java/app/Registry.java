package app;

public class Registry {
    private static Registry instance;

    private Registry() {}

    public static Registry getInstance() {
        if (instance == null) instance = new Registry();
        return instance;
    }
}
