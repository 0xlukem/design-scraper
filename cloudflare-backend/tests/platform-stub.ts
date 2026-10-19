// Only unit tests use this constructor. Runtime tests execute the real workerd class.
export class DurableObject<T> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: T,
  ) {}
}
