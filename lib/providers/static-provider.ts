import manifest from '../../datasets.json'
import { matchesCatalogQuery, validateCatalogAccess } from '../datasets'
import type {
  DataProvider,
  Dataset,
  DatasetQuery,
  ProviderCapabilities,
} from './types'

const manifestDatasets = manifest as Dataset[]
validateCatalogAccess(manifestDatasets)

export class StaticProvider implements DataProvider {
  readonly name = 'static'
  private readonly datasets: Dataset[]

  readonly capabilities: ProviderCapabilities = {
    search: false,
    query: false,
    write: false,
    rbac: false,
  }

  constructor(
    datasets: Dataset[] = manifestDatasets,
    private readonly environment = process.env.NODE_ENV,
  ) {
    validateCatalogAccess(datasets)
    this.datasets = datasets
  }

  private visibleDatasets(): Dataset[] {
    return this.environment === 'development'
      ? this.datasets
      : this.datasets.filter((dataset) => dataset.draft !== true)
  }

  async listDatasets(): Promise<Dataset[]> {
    return this.visibleDatasets()
  }

  async getDataset(namespace: string, slug: string): Promise<Dataset | null> {
    return (
      this.visibleDatasets().find((d) => d.namespace === namespace && d.slug === slug) ?? null
    )
  }

  async search({ q, namespace, format }: DatasetQuery): Promise<Dataset[]> {
    return this.visibleDatasets().filter((d) =>
      (!namespace || d.namespace === namespace) &&
      (!format || d.format === format) &&
      matchesCatalogQuery(d, q ?? '')
    )
  }
}
