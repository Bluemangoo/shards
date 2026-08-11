export type WithError<T, E = Error | undefined> = {
    data: T;
    error: E;
};
