import { createContext } from "react";

interface User {
  id: string;
  email: string;
  name?: string;
}

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  loginWithEmail: () => void;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  completeWebViewAuth: () => Promise<boolean>;
  setTokensFromWebView: (tokens: TokenData) => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextType | null>(null);
