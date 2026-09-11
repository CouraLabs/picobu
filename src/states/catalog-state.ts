import { createSignal } from 'solid-js'

const [catalogVersion, setCatalogVersion] = createSignal(0)

export const bumpCatalog = (): void => {
  setCatalogVersion((v) => v + 1)
}

export { catalogVersion }
