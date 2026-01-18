import { createContext } from "react";

interface User {
  id: string;
  email: string;
  name?: string;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  loginWithGitHub: () => Promise<void>;
  loginWithGitLab: () => Promise<void>;
  loginWithEmail: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthContextType | null>(null);
