import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Chinese Students Club",
  description:
    "Chinese Students Club is the oldest cultural club at MIT. Throughout the years we've continued to be a hub for people who like Chinese-American culture, good food, and good company. We're here to help the people of MIT and Boston create memories and friends at our events (inspired by Chinese-American culture). Whether you need a study break, free boba, or a boat to party on, CSC is here for you!",
  metadataBase: new URL("https://mitcsc.mit.edu"),
  twitter: {
    card: "summary_large_image",
    title: "Chinese Students Club",
    description:
      "Chinese Students Club is the oldest cultural club at MIT. Throughout the years we've continued to be a hub for people who like Chinese-American culture, good food, and good company. We're here to help the people of MIT and Boston create memories and friends at our events (inspired by Chinese-American culture). Whether you need a study break, free boba, or a boat to party on, CSC is here for you!",
    images: ["/img/preview.png"],
  },
  openGraph: {
    title: "Chinese Students Club",
    description:
      "Chinese Students Club is the oldest cultural club at MIT. Throughout the years we've continued to be a hub for people who like Chinese-American culture, good food, and good company. We're here to help the people of MIT and Boston create memories and friends at our events (inspired by Chinese-American culture). Whether you need a study break, free boba, or a boat to party on, CSC is here for you!",
    url: "https://mitcsc.mit.edu",
    images: [
      {
        url: "/img/preview.png",
      },
    ],
    locale: "en_US",
    siteName: "Chinese Students Club",
    type: "website",
  },
  icons: {
    icon: ["/img/favicon/favicon.ico"],
    apple: ["/img/favicon/apple-touch-icon.png"],
    shortcut: ["/img/favicon/apple-touch-icon.png"],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`antialiased font-primary font-bold flex flex-col items-center w-full`}
      >
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
