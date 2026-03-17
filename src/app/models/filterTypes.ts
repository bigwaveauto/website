import { DetailedFiltersResult } from "./searchModels";

export interface ActiveFilter {
  datacol: string;
  type: string;
}

export interface FilterTypes {
  year: FilterOption;
  price: FilterOption;
  condition: FilterOption;
  body: FilterOption;
  make: FilterOption;
  model: FilterOption;
  highlights: FilterOption;
  seatingcapacity: FilterOption;
  interiorcolorstandard: FilterOption;
  exteriorcolorstandard: FilterOption;
  fuel: FilterOption;
  transmissionstandard: FilterOption;
  drivetrainstandard: FilterOption;
  engine: FilterOption;
}

interface FilterOption {
  displayName: string;
  include: boolean;
  highlightifone?: boolean;
}

export type FilterKey = keyof DetailedFiltersResult;