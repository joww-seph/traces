export type Category = 'semi' | 'ppe'

// BR-01: at or above the threshold is PPE.
export function categorize(unitCostCentavos: number, thresholdCentavos: number): Category {
  return unitCostCentavos >= thresholdCentavos ? 'ppe' : 'semi'
}
