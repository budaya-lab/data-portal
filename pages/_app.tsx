import type { AppProps } from "next/app";
import Footer from "../components/Footer";
import Navbar from "../components/Navbar";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="flex-1">
        <Component {...pageProps} />
      </div>
      <Footer />
    </div>
  );
}
