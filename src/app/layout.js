import './globals.css';

export const metadata = {
  title: 'Muse Session Hub - Next.js 16 App',
  description: 'Trình quản lý session và tự động đăng nhập Muse Web bằng Cookie xây dựng trên Next.js phiên bản mới nhất.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="ambient-glow glow-top-left"></div>
        <div className="ambient-glow glow-bottom-right"></div>
        <div className="ambient-glow glow-center"></div>
        {children}
      </body>
    </html>
  );
}
