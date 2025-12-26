import React, { useRef } from 'react';
import { Scale, FileText, BarChart3 } from 'lucide-react';
import Footer from '../components/Footer';


const ServicesPage = () => {
  const heroRef = useRef(null);

  const services = [
    {
      icon: FileText,
      title: "Document Upload",
      description: "Securely upload and organize all your legal documents. Our platform supports various formats, ensuring your data is always accessible and protected.",
      link: "/document-upload",
      delay: 0
    },
    {
      icon: BarChart3,
      title: "AI Analysis",
      description: "Utilize advanced AI to summarize complex legal texts, identify key entities, and extract critical information, saving you countless hours.",
      link: "/ai-analysis",
      delay: 0.7
    },
    {
      icon: Scale,
      title: "Document Drafting",
      description: "Generate precise legal documents, contracts, and briefs with AI-powered drafting tools and customizable templates, ensuring accuracy and compliance.",
      link: "/document-drafting",
      delay: 1.4
    }
  ];

  return (
    <div className="bg-white">
      <section
        ref={heroRef}
        className="relative pt-32 pb-20"
        style={{
          background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
        }}
      >
        <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-12 animate-fade-in">
            Our Core Services
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {services.map((service, index) => {
              const Icon = service.icon;
              return (
                <div
                  key={index}
                  className="group relative animate-slide-up"
                  style={{ animationDelay: `${index * 150}ms` }}
                >
                  <div
                    className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500 animate-pulse-slow"
                    style={{ backgroundColor: '#21C1B6' }}
                  />
                  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl group-hover:-translate-y-2 transition-all duration-500">
                    <div
                      className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg group-hover:scale-110 group-hover:rotate-6 transition-all duration-400"
                      style={{ backgroundColor: '#e0f7f6' }}
                    >
                      <Icon className="w-8 h-8" style={{ color: '#21C1B6' }} />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-3 text-center">
                      {service.title}
                    </h4>
                    <p className="text-sm text-gray-600 text-center leading-relaxed mb-5">
                      {service.description}
                    </p>
                    <a
                      href={service.link}
                      className="text-gray-700 hover:text-gray-900 font-medium block text-center transition-colors duration-300"
                    >
                      Learn More &rarr;
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(50px) rotateX(-15deg);
          }
          to {
            opacity: 1;
            transform: translateY(0) rotateX(0);
          }
        }

        @keyframes pulse-slow {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.8s ease-out forwards;
        }

        .animate-slide-up {
          animation: slide-up 0.7s ease-out forwards;
          opacity: 0;
        }

        .animate-pulse-slow {
          animation: pulse-slow 2s ease-in-out infinite;
        }
      `}</style>
      <Footer />
    </div>
  );
};

export default ServicesPage;
