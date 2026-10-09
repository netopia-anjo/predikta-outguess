import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Outguess the Crowd · AdSpark × Predikta',
  description: 'Read the audience. Trust your instincts. A three-round booth game by AdSpark and Predikta.',
  robots: {index:false,follow:false}
};
export const viewport: Viewport = {themeColor:'#ECEFF4',width:'device-width',initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body><div id="app">{children}</div></body></html>;
}
