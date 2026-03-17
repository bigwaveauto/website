export interface VehicleApiResponse {
  meta: {
    identifier: string;
  };
  results: VehicleExtended;
}

export interface VehicleExtended {
  id: number;
  dealer_id: number;
  vin: string;
  status: string;
  statusoverride: string;
  featured: number;
  stocknumber: string;
  location: string;
  originalprice: number;
  price: number;
  adjustmentlabel: string | null;
  specialprice: number;
  specialpricelabel: string | null;
  addonprice: number;
  addonpricelabel: string | null;
  addonpricedescription: string | null;
  msrp: number | null;
  year: number;
  make: string;
  model: string;
  modelnumber: string;
  trim: string;
  series: string | null;
  body: string;
  style: string | null;
  commercial: number;
  condition: string;
  certified: number;
  mileage: number;
  exteriorcolor: string;
  exteriorcolorstandard: string;
  interiorcolor: string;
  interiorcolorstandard: string;
  fuel: string;
  transmission: string;
  transmissionstandard: string;
  drivetrain: string;
  drivetrainstandard: string;
  engine: string;
  displacement: number;
  cylinders: number;
  blocktype: string;
  powercycle: string | null;
  maxhorsepower: number;
  maxhorsepowerat: number;
  maxtorque: number;
  maxtorqueat: number;
  aspiration: string;
  mpgcity: number;
  mpghwy: number;
  evrange: number | null;
  evbatterycapacity: number | null;
  evchargerrating: number | null;
  doors: number;
  fueltank: number;
  seatingcapacity: number;
  towingcapacity: number | null;
  dimensions: string | null;
  axle: string | null;
  axleratio: string | null;
  reardoorgate: string | null;
  gvwr: number | null;
  emptyweight: number | null;
  loadcapacity: number | null;
  dimension_width: number;
  dimension_length: number;
  dimension_height: number;
  bedlength: number | null;
  wheelbase: number;
  frontwheel: string;
  rearwheel: string;
  fronttire: string;
  reartire: string;
  carfaxurl: string;
  carfaxicon: string;
  carfaxalt: string;
  carfaxoneowner: number;
  carfaxownerstext: string;
  carfaxownersicon: string;
  carfaxusetext: string;
  carfaxuseicon: string;
  carfaxservicerecords: number;
  carfaxaccidenttext: string;
  carfaxaccidenticon: string;
  carfaxsnapshotkey: string;
  autocheck: string | null;
  monroneysticker: string | null;
  photocount: number;
  notes: string;
  tags: string[] | null;

  highlights: {
    Interior: string[];
    Exterior: string[];
    ['Entertainment and Technology']: string[];
    ['Safety and Security']: string[];
    Performance: string[];
  };

  incentives: any[];
  metatitle: string | null;
  metadescription: string | null;
  vehicledescription: string | null;
  additionaldetails: string | null;
  pricingdisclaimer: string | null;
  hideestimatedpayments: number;
  schemabody: string;
  title: string;
  url: string;
  hot: number;
  new: number;
  bodyshippingstandard: string;

  photos: VehiclePhoto[];
  video: VehicleVideo;
  onhold: boolean;
  tiles: string[];
  installedoptions: any[];

  finance: VehicleFinance;
}

export interface VehiclePhoto {
  id: number;
  large: string;
  thumbnail: string | null;
  sortorder: number;
}

export interface VehicleVideo {
  source: string | null;
  url: string | null;
  autoplay: boolean | null;
  aspectratio: string | null;
}

export interface VehicleFinance {
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
}