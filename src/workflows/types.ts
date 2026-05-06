export type IntegrationSkipReason =
  | "aggregate_not_green"
  | "no_consumer"
  | "no_contract_no_consumer"
  | "not_published";
