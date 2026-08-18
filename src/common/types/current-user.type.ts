export interface CurrentUserPayload {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  status: string;
  companyId?: string | null;
  companyIds: string[];
  permissions: string[];
}
