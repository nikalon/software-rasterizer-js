# Por hacer
- Rotar los objetos en pantalla para que no se vea tan estático
- Shading
- Matriz de proyección
    - Mantener proporciones de la escena renderizada independientemente de la relación de aspecto del canvas
- Cámara dinámica
    - Mover con teclado
    - Mover con ratón (pan, zoom, etc)
- Implementar model matrix para transformar las coordenadas locales a globales
    - Cargar más modelos en la escena
- Corregir interpolación de colores en base a la orientación del triángulo en pantalla
- Anti alias

# Terminado
- Cargar ficheros .obj con sus vértices, triángulos y colores en los vértices
    - Nota: solo se pueden cargar modelos que tengan mallas triangulares (3 vértices)
- Rasterizador básico con colores planos
- Backface culling
- Z-buffer

# Bugs
- Cuando un triángulo grande sobresale de pantalla no se renderiza. Pista: edge() retorna un área negativa para el triángulo.
