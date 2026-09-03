from setuptools import setup, Extension

module1 = Extension('hpl_native',
                    sources = ['hpl_native.c'])

setup (name = 'hpl_native',
       version = '1.0',
       description = 'True Native C Extension for Hallucination Prevention Layer',
       ext_modules = [module1])
