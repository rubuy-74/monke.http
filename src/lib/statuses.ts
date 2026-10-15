import statusesJson from '../data/statuses.json';

export type Status = (typeof statusesJson)[number];

export const statuses = statusesJson as Status[];

export function getStatus(code: string | number) {
  return statuses.find((status) => status.code === Number(code));
}
