export function createStubRule(id, category) {
    return {
        id,
        category,
        async detect(_input) {
            // TODO(engine): implement detection after the frozen contract is accepted.
            return null;
        },
    };
}
