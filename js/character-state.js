/** Estado mutable del personaje durante una partida, separado del proyecto diseñado. */
export class PlayerCharacterState {
  constructor(sheet = {}) {
    this.name = "Jugador";
    this.attributes = new Map((Array.isArray(sheet?.attributes) ? sheet.attributes : []).map((attribute) => [
      String(attribute?.id || ""),
      Number(attribute?.initialValue) || 0,
    ]).filter(([id]) => id));
    this.distributablePoints = Math.max(0, Math.floor(Number(sheet?.distributablePoints) || 0));
    this.progress = 0;
    this.completedModules = new Set();
    this.rewardedCombats = new Set();
    this.rewardedQuizzes = new Set();
  }

  configure({ name = "Jugador", values = null, distributablePoints = this.distributablePoints } = {}) {
    this.name = String(name || "Jugador").trim().slice(0, 80) || "Jugador";
    if (values && typeof values === "object") {
      for (const [attributeId, value] of Object.entries(values)) {
        if (this.attributes.has(attributeId)) this.attributes.set(attributeId, Number(value) || 0);
      }
    }
    this.distributablePoints = Math.max(0, Math.floor(Number(distributablePoints) || 0));
  }

  distribute(attributeId, delta = 1) {
    const id = String(attributeId || "");
    const amount = Math.trunc(Number(delta) || 0);
    if (!this.attributes.has(id) || !amount || (amount > 0 && this.distributablePoints < amount)) return false;
    this.attributes.set(id, this.attributes.get(id) + amount);
    this.distributablePoints = Math.max(0, this.distributablePoints - amount);
    return true;
  }

  value(attributeId) {
    return Number(this.attributes.get(String(attributeId || ""))) || 0;
  }

  change(attributeId, delta = 0) {
    const id = String(attributeId || "");
    if (!this.attributes.has(id)) return false;
    this.attributes.set(id, this.value(id) + (Number(delta) || 0));
    return true;
  }

  award(sheet, event, sourceId = "") {
    const id = String(sourceId || "");
    const tracker = event === "module-completed" ? this.completedModules
      : event === "combat-won" ? this.rewardedCombats
        : event === "quiz-solved" ? this.rewardedQuizzes : null;
    if (!tracker || (id && tracker.has(id))) return 0;
    if (id) tracker.add(id);
    const amount = (sheet?.progressionRules || [])
      .filter((rule) => rule?.event === event)
      .reduce((sum, rule) => sum + (Number(rule.pointsPerUnit) || 0), 0);
    this.progress += amount;
    return amount;
  }

  toJSON() {
    return {
      name: this.name,
      attributes: Object.fromEntries(this.attributes),
      distributablePoints: this.distributablePoints,
      progress: this.progress,
      completedModules: [...this.completedModules],
      rewardedCombats: [...this.rewardedCombats],
      rewardedQuizzes: [...this.rewardedQuizzes],
    };
  }
}
