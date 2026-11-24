export type Category = 'semi' | 'ppe'

export function categorize(unitCostCentavos: number, thresholdCentavos: number): Category {
  return unitCostCentavos >= thresholdCentavos ? 'ppe' : 'semi'
}
