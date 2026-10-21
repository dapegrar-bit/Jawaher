import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title:'جواهر ميزان | المحاسبة الذكية',
  description:'جواهر ميزان - نسخة تجريبية موحدة لإدارة الحسابات والمبيعات والمشتريات والتقارير'
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
