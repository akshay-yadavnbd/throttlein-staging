/** Pure helpers for the category tree: no I/O. */

/** Flat category docs → nested roots, each level sorted by `order` then name. */
function buildTree(items) {
  const byId = new Map();
  for (const c of items) {
    byId.set(c._id.toString(), { ...c.toObject(), children: [] });
  }
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent && byId.has(node.parent.toString())) {
      byId.get(node.parent.toString()).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortLevel = (arr) => {
    arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    arr.forEach((c) => sortLevel(c.children));
  };
  sortLevel(roots);
  return roots;
}

/**
 * Post-order walk that marks every tree node with `hasProducts`: true
 * when the node itself — or ANY descendant — carries at least one
 * visible product. `usedIds` holds the category AND bike ids found on
 * active products from approved sellers (Shop-by-Bike nodes attach
 * products via the `bike` field, not `category`, so both are needed).
 */
function markHasProducts(nodes, usedIds) {
  let any = false;
  for (const node of nodes) {
    const own = usedIds.has(String(node._id));
    const childAny = markHasProducts(node.children || [], usedIds);
    node.hasProducts = own || childAny;
    if (node.hasProducts) any = true;
  }
  return any;
}

module.exports = { buildTree, markHasProducts };
