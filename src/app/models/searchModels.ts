export interface InventoryResponse {
  meta: {
    limit: number;
    offset: number;
    sortby: string;
    sortorder: string;
    total: number;
    condition: string[];
    body: string[];
    make: string[];
    finance: {
      months: number;
      tier: string | null;
      rate: string;
      down_pct: number | null;
      down_amount: number | null;
    };
    pagetitle: string;
    params: {
      vin: string;
    };
  };
  results: Vehicle[];
}

export interface Vehicle {
  vin: string;
  featuredphoto: string;
  id: number;
  dealer_id: number;
  status: string;
  statusoverride: string;
  featured: number;
  stocknumber: string;
  location: string;
  originalprice: number;
  price: number;
  specialprice: string;
  addonprice: string;
  msrp: number | null;
  year: number;
  make: string;
  model: string;
  modelnumber: string;
  trim: string;
  series: string | null;
  body: string;
  condition: string;
  certified: number;
  mileage: number;
  exteriorcolor: string;
  interiorcolor: string;
  exteriorcolorstandard: string;
  interiorcolorstandard: string;
  fuel: string;
  drivetrainstandard: string;
  doors: number;
  seatingcapacity: number;
  photocount: number;
  tags: string | null;
  highlights: string[];
  dealer: {
    name: string;
    city: string;
    state: string;
    phonemain: string;
  };
  title: string;
  url: string;
  hot: number;
  new: number;
  wholesale: number;
  finance: {
    fees: any[];
    vehicle_amount: number;
    shipping_amount: number;
    tradein_amount: number;
    tradein_remainingbalance: number;
    down_payment: number;
    doctitlefees_amount: number;
    tax_amount: number;
    tax_rate: number;
    tax_rate_formatted: number;
    tax_tradeincredit: number | null;
    loan_amount: number;
    loan_months: number;
    interest_rate: number;
    interest_rate_formatted: number;
    credit_tier: string;
    total_cost: number;
    total_interest: number;
    monthly_payment: number;
  };
  photos: string[];
  video: {
    source: string | null;
    url: string | null;
    autoplay: string | null;
    aspectratio: string | null;
  };
};

export interface InventoryQueryParams {
    vin?: string;
    condition?: string | string[];
    year?: number | { gt?: number; lt?: number };
    mileage?: number | { gt?: number; lt?: number };
    price?: number | { gt?: number; lt?: number };
    bodystyle?: string | string[];
    highlights?: string | string[];
    seatingcapacity?: number;
    interiorcolorstandard?: string;
    exteriorcolorstandard?: string;
    make?: string | string [];
    model?: string | string [];
    body?: string | string[];
    fuel?: string;
    drivetrainstandard?: string;
    engine?: string;
    transmissionstandard?: string;
  };

  export interface InventoryFiltersResponse {
    meta: { cache: boolean };
    results: InventoryFiltersResult
  }

  export interface InventoryFiltersResult{
      filters: DetailedFiltersResult;
  };
  
  export interface DetailedFiltersResult {
        price: { min: number; max: number };
        make: { counts: Record<string, number> };
        model: { counts: Record<string, number> };
        trim: { counts: Record<string, number> };
        condition: { counts: Record<string, number> };
        dealer_id: { counts: any };
        location: { counts: Record<string, number> };
        year: { min: number; max: number };
        mileage: { min: number; max: number; buckets: Record<string, number> };
        body: { counts: Record<string, number> };
        seatingcapacity: { counts: Record<string, number> };
        highlights: Record<string, number>;
        exteriorcolorstandard: { counts: Record<string, number> };
        interiorcolorstandard: { counts: Record<string, number> };
        fuel: { counts: Record<string, number> };
        transmissionstandard: { counts: Record<string, number> };
        drivetrainstandard: { counts: Record<string, number> };
        engine: { counts: Record<string, number> };
        modelgroups: Record<string, Record<string, number>>;
        trimgroups: Record<string, Record<string, number>>;
  };
  // Combined shape
  export interface InventorySearchResponse {
    inventory: InventoryResponse;
    filters: InventoryFiltersResponse;
  }