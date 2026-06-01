import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211f",
        moss: "#31473f",
        copper: "#a45f3d",
        parchment: "#f5efe3",
        mist: "#d8e2dc",
        ember: "#d44f2f"
      }
    }
  },
  plugins: []
};

export default config;
