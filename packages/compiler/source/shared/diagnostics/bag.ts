import type { Diagnostic } from './diagnostic.js'

/**
 * Collects diagnostics produced by a compiler stage.
 */
export class DiagnosticBag {
  private readonly _diagnostics: Diagnostic[] = []

  /** Diagnostics collected so far, in report order. */
  public get all(): readonly Diagnostic[] {
    return this._diagnostics
  }

  /** Whether the bag holds no diagnostics. */
  public get empty(): boolean {
    return this._diagnostics.length === 0
  }

  /** Whether the bag holds at least one diagnostic with `error` severity. */
  public get hasErrors(): boolean {
    return this._diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  }

  /**
   * Adds a diagnostic to the bag.
   *
   * @param diagnostic Diagnostic to collect.
   */
  public add(diagnostic: Diagnostic): void {
    this._diagnostics.push(diagnostic)
  }

  /**
   * Adds every diagnostic of the given bag.
   *
   * @param bag Bag whose diagnostics are copied over.
   */
  public addAll(bag: DiagnosticBag): void {
    this._diagnostics.push(...bag.all)
  }

  /** Removes every diagnostic from the bag. */
  public clear(): void {
    this._diagnostics.length = 0
  }
}
