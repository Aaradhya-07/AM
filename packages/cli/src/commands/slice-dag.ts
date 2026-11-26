interface SliceDependency {
  id: string;
  dependsOn: readonly string[];
}

export function sliceWaves(
  tasks: readonly SliceDependency[],
  maxParallel = tasks.length,
): string[][] {
  if (!Number.isSafeInteger(maxParallel) || maxParallel < 1)
    throw new Error("Maximum parallel slices must be a positive integer");
  const pending = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  if (pending.size !== tasks.length) throw new Error("Duplicate slice id");
  for (const [id, dependencies] of pending) {
    if (dependencies.some((dependency) => !pending.has(dependency)))
      throw new Error("Unknown dependency in slice " + id);
    if (new Set(dependencies).size !== dependencies.length)
      throw new Error("Duplicate dependency in slice " + id);
  }
  const waves: string[][] = [];
  while (pending.size) {
    const ready = [...pending]
      .filter(([, dependencies]) =>
        dependencies.every((dependency) => !pending.has(dependency)),
      )
      .map(([id]) => id)
      .sort()
      .slice(0, maxParallel);
    if (ready.length === 0)
      throw new Error(
        "Dependency cycle among slices: " +
          [...pending.keys()].sort().join(", "),
      );
    for (const id of ready) pending.delete(id);
    waves.push(ready);
  }
  return waves;
}
