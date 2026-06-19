// Shared helpers for grouping the category taxonomy by its `group` field.

export const GROUP_ORDER = [
  'Dish Type / Course', 'Cuisine / Region', 'Occasion / Festival',
  'Dietary Preference', 'Cooking Method', 'Time / Effort', 'Season / Weather',
]

export interface CategoryGroup { group: string; items: string[] }

// Group category records by their `group` field, in the canonical group order.
export function groupCategories(records: { name: string; group?: string }[]): CategoryGroup[] {
  const map = new Map<string, string[]>()
  for (const r of records) {
    const g = r.group || 'Other'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(r.name)
  }
  return [...map.entries()]
    .sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a[0]); const ib = GROUP_ORDER.indexOf(b[0])
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map(([group, items]) => ({ group, items }))
}
