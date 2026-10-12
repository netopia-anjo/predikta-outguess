import type { Metadata, Viewport } from 'next';
import './globals.css';
import './predikta-dark-theme.css';
export const metadata: Metadata = {
  title: 'Outguess the Crowd · AdSpark × Predikta',
  description: 'Read the audience. Trust your instincts. A three-round booth game by AdSpark and Predikta.',
  robots: {index:false,follow:false}
};
export const viewport: Viewport = {themeColor:'#071447',colorScheme:'dark',width:'device-width',initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body><div id="app">{children}</div></body></html>;
}
