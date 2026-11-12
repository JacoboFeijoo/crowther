/** Estado del inventario durante una partida; no forma parte del proyecto editable. */
export class InventoryState {
  constructor() {
    this.items = [];
    this.clues = [];
    this.notesHtml = "";
    this.attributeBonuses = new Map();
  }

  addClue(id, text, { capacity = 10 } = {}) {
    const clueId = String(id || "");
    const clueText = String(text || "").trim();
    if (!clueId || !clueText) return { ok: false, reason: "empty" };
    const existing = this.clues.find((clue) => clue.id === clueId);
    if (existing) return { ok: false, reason: "duplicate", clue: existing };
    const limit = Math.max(0, Math.floor(Number(capacity) || 0));
    if (this.clues.length >= limit) return { ok: false, reason: "full" };
    const clue = { id: clueId, text: clueText };
    this.clues.push(clue);
    return { ok: true, reason: "added", clue };
  }

  setNotes(html = "") {
    this.notesHtml = String(html || "");
  }

  addAttributeBonus(assetId, attributeId, amount = 0) {
    const resourceId = String(assetId || "");
    const key = String(attributeId || "");
    if (!resourceId || !key) return false;
    const bonuses = this.attributeBonuses.get(resourceId) || new Map();
    bonuses.set(key, (Number(bonuses.get(key)) || 0) + (Number(amount) || 0));
    this.attributeBonuses.set(resourceId, bonuses);
    return true;
  }

  add(assetId, { unique = false, capacity = 0 } = {}) {
    const id = String(assetId || "");
    if (!id) return { ok: false, reason: "missing" };

    const existing = this.items.find((item) => item.assetId === id);
    if (existing) {
      if (unique || existing.unique) return { ok: false, reason: "unique", item: existing };
      existing.quantity = Math.min(9999, existing.quantity + 1);
      return { ok: true, reason: "stacked", item: existing };
    }

    const slots = Math.max(0, Math.floor(Number(capacity) || 0));
    if (this.items.length >= slots) return { ok: false, reason: "full" };

    const item = { assetId: id, quantity: 1, unique: Boolean(unique) };
    this.items.push(item);
    return { ok: true, reason: "added", item };
  }

  remove(assetId) {
    const index = this.items.findIndex((item) => item.assetId === String(assetId || ""));
    if (index < 0) return null;
    return this.items.splice(index, 1)[0];
  }

  consume(assetId, quantity = 1) {
    const id = String(assetId || "");
    const amount = Math.max(1, Math.floor(Number(quantity) || 1));
    const index = this.items.findIndex((item) => item.assetId === id);
    if (index < 0 || this.items[index].quantity < amount) return false;
    this.items[index].quantity -= amount;
    if (this.items[index].quantity <= 0) this.items.splice(index, 1);
    return true;
  }

  replace(assetId, resultAssetId, { capacity = 0, unique = false } = {}) {
    const originalIndex = this.items.findIndex((item) => item.assetId === String(assetId || ""));
    const snapshot = this.items.map((item) => ({ ...item }));
    if (!this.consume(assetId)) return { ok: false, reason: "missing" };
    const added = this.add(resultAssetId, { capacity, unique });
    if (!added.ok) {
      this.items = snapshot;
      return added;
    }
    if (added.reason !== "stacked" && added.item) {
      const resultIndex = this.items.indexOf(added.item);
      this.items.splice(resultIndex, 1);
      this.items.splice(Math.min(originalIndex, this.items.length), 0, added.item);
    }
    return { ...added, reason: "replaced" };
  }

  combine(firstAssetId, secondAssetId, resultAssetId, { capacity = 0, unique = false } = {}) {
    const firstId = String(firstAssetId || "");
    const secondId = String(secondAssetId || "");
    if (!firstId || !secondId) return { ok: false, reason: "missing" };
    const firstIndex = this.items.findIndex((item) => item.assetId === firstId);
    const snapshot = this.items.map((item) => ({ ...item }));
    if (!this.consume(firstId) || !this.consume(secondId)) {
      this.items = snapshot;
      return { ok: false, reason: "insufficient" };
    }
    const added = this.add(resultAssetId, { capacity, unique });
    if (!added.ok) {
      this.items = snapshot;
      return added;
    }
    if (added.reason !== "stacked" && added.item) {
      const resultIndex = this.items.indexOf(added.item);
      this.items.splice(resultIndex, 1);
      const firstRemains = this.items.some((item) => item.assetId === firstId);
      const insertIndex = firstRemains ? firstIndex + 1 : firstIndex;
      this.items.splice(Math.min(insertIndex, this.items.length), 0, added.item);
    }
    return { ...added, reason: "combined" };
  }

  clear() {
    this.items = [];
    this.clues = [];
    this.notesHtml = "";
    this.attributeBonuses.clear();
  }
}

/** Añade el botón de consulta de atributos a una miniatura de objeto. */
export function appendInventoryAttributeInfo(slot, asset, project, bonuses = null) {
  if (!slot || !asset) return;
  const definitions = new Map((project?.objectAttributeDefinitions || []).map((attribute) => [attribute.id, attribute.name]));
  const values = (asset.attributes || []).filter((attribute) => definitions.has(attribute.attributeId));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inventory-item-attribute-info";
  button.textContent = "?";
  button.setAttribute("aria-label", `Consultar atributos de ${asset.name || "objeto"}`);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-haspopup", "dialog");
  button.title = "Ver atributos del objeto";

  const panel = document.createElement("dialog");
  panel.className = "inventory-item-attributes-dialog";
  panel.setAttribute("aria-label", `Atributos de ${asset.name || "objeto"}`);
  const heading = document.createElement("div");
  heading.className = "inventory-item-attributes-heading";
  const title = document.createElement("strong");
  title.textContent = asset.name || "Atributos del objeto";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button inventory-item-attributes-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Cerrar atributos");
  close.addEventListener("click", () => {
    if (typeof panel.close === "function") panel.close();
    else {
      panel.removeAttribute("open");
      button.setAttribute("aria-expanded", "false");
      slot.classList.remove("has-attribute-details");
    }
  });
  heading.append(title, close);
  panel.append(heading);
  if (!values.length) {
    const empty = document.createElement("p");
    empty.textContent = "Este objeto no tiene atributos configurados.";
    panel.append(empty);
  } else {
    values.forEach((attribute) => {
      const row = document.createElement("p");
      const name = document.createElement("strong");
      name.textContent = `${definitions.get(attribute.attributeId)}: `;
      const value = document.createElement("span");
      const bonus = bonuses instanceof Map ? Number(bonuses.get(attribute.attributeId)) || 0 : 0;
      value.textContent = String((Number(attribute.value) || 0) + bonus);
      row.append(name, value);
      panel.append(row);
    });
  }
  panel.addEventListener("close", () => {
    button.setAttribute("aria-expanded", "false");
    slot.classList.remove("has-attribute-details");
  });
  panel.addEventListener("click", (event) => {
    if (event.target === panel) panel.close?.();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = !panel.open;
    if (open && typeof panel.showModal === "function") panel.showModal();
    else if (open) panel.setAttribute("open", "");
    else if (typeof panel.close === "function") panel.close();
    else panel.removeAttribute("open");
    button.setAttribute("aria-expanded", String(open));
    slot.classList.toggle("has-attribute-details", open);
  });
  slot.append(button, panel);
}

/** Resuelve recetas configuradas en las capas de imagen del proyecto. */
export class CombinationRules {
  static resources(project) {
    return [...(project?.assets || []), ...(project?.soundAssets || [])];
  }

  static resource(project, assetId) {
    const id = String(assetId || "");
    return (project?.assets || []).find((asset) => asset.id === id)
      || (project?.soundAssets || []).find((asset) => asset.id === id)
      || null;
  }

  static resourceType(project, assetId) {
    if ((project?.assets || []).some((asset) => asset.id === assetId)) return "image";
    if ((project?.soundAssets || []).some((asset) => asset.id === assetId)) return "sound";
    return null;
  }

  static resolve(project, firstAssetId, secondAssetId, preferredSourceLayerId = null) {
    const firstId = String(firstAssetId || "");
    const secondId = String(secondAssetId || "");
    if (!firstId || !secondId) return null;
    const layers = (project?.scenes || []).flatMap((scene) => scene.stage?.layers || []);
    const layerById = new Map(layers.map((layer) => [layer.id, layer]));
    const validResources = new Set(CombinationRules.resources(project).map((asset) => asset.id));

    const findSourceRule = (sourceAssetId, partnerAssetId, preferredId = null) => {
      const sourceLayers = layers.filter((layer) => layer.assetId === sourceAssetId);
      if (preferredId) sourceLayers.sort((first, second) => Number(second.id === preferredId) - Number(first.id === preferredId));
      for (const layer of sourceLayers) {
        if (!layer.combinableEnabled) continue;
        const compatibleResources = Array.isArray(layer.combinableWithResourceIds)
          ? layer.combinableWithResourceIds.map(String)
          : [];
        const legacyLayerMatch = (Array.isArray(layer.combinableWithLayerIds) ? layer.combinableWithLayerIds : [])
          .some((layerId) => layerById.get(String(layerId))?.assetId === partnerAssetId);
        if (!compatibleResources.includes(partnerAssetId) && !legacyLayerMatch) continue;
        const resultAssetId = String(layer.combinationResultAssetId || "");
        if (!validResources.has(resultAssetId)) continue;
        return { resultAssetId, sourceLayerId: layer.id, sourceAssetId };
      }
      return null;
    };

    return findSourceRule(firstId, secondId, preferredSourceLayerId)
      || findSourceRule(secondId, firstId)
      || null;
  }

  static compatibleResourceIds(project, assetId, preferredSourceLayerId = null) {
    const id = String(assetId || "");
    return CombinationRules.resources(project)
      .map((asset) => asset.id)
      .filter((otherId) => otherId !== id && CombinationRules.resolve(project, id, otherId, preferredSourceLayerId));
  }

  static canStart(project, assetId, preferredSourceLayerId = null) {
    return CombinationRules.compatibleResourceIds(project, assetId, preferredSourceLayerId).length > 0;
  }

  static isUnique(project, assetId) {
    return (project?.scenes || []).some((scene) => (scene.stage?.layers || [])
      .some((layer) => layer.assetId === assetId && layer.unique));
  }
}
