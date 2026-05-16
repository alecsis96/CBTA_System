import { prisma } from './db'

const baseConcepts = [
  {
    code: 'A000',
    groupCode: 'A000',
    name: 'Servicios administrativos escolares',
    description: 'Agrupa los ingresos provenientes de la prestacion de servicios administrativos educativos que requieran los estudiantes y egresados del plantel.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    code: 'A001',
    groupCode: 'A000',
    name: 'Acreditacion, certificacion y convalidacion de estudios',
    description: 'Ingresos provenientes de la acreditacion, certificacion y convalidacion de estudios que requieran los alumnos de todos los niveles educativos.',
    amount: 80,
    periodLabel: '2026-A',
  },
  {
    code: 'A002',
    groupCode: 'A000',
    name: 'Expedicion y otorgamiento de documentos oficiales',
    description: 'Ingresos provenientes de la expedicion y otorgamiento de documentos academicos y oficiales como cartas, credenciales, constancias, diplomas, titulos y tramites relacionados.',
    amount: 150,
    periodLabel: '2026-A',
  },
  {
    code: 'A003',
    groupCode: 'A000',
    name: 'Examenes',
    description: 'Ingresos provenientes del pago de derechos por examenes extraordinarios, de regularizacion, recuperacion, especiales y otros tramites de evaluacion.',
    amount: 100,
    periodLabel: '2026-A',
  },
  {
    code: 'A004',
    groupCode: 'A000',
    name: 'Otros',
    description: 'Conceptos de ingreso que no se ubiquen especificamente en los anteriores pero que sean afines al grupo.',
    amount: 50,
    periodLabel: '2026-A',
  },
  {
    code: 'B000',
    groupCode: 'B000',
    name: 'Aportaciones y cuotas de cooperacion voluntaria',
    description: 'Agrupa los ingresos provenientes de estudiantes y particulares que apoyan la labor educativa, la practica escolar y la formacion academica.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    code: 'B001',
    groupCode: 'B000',
    name: 'Cuotas de cooperacion voluntaria',
    description: 'Ingresos provenientes de las cooperaciones voluntarias que aportan los alumnos por cursos normales, especiales o periodicos.',
    amount: 250,
    periodLabel: '2026-A',
  },
  {
    code: 'B002',
    groupCode: 'B000',
    name: 'Aportaciones, cooperaciones y donaciones al plantel',
    description: 'Ingresos provenientes en efectivo y bienes que incrementen el patrimonio de la Secretaria por parte de estudiantes, profesores, particulares o instituciones.',
    amount: 372,
    periodLabel: '2026-A',
  },
  {
    code: 'B003',
    groupCode: 'B000',
    name: 'Beneficios',
    description: 'Ingresos provenientes de porcentajes de utilidad neta y beneficios obtenidos por actividades del plantel, cooperativas o eventos.',
    amount: 120,
    periodLabel: '2026-A',
  },
  {
    code: 'B004',
    groupCode: 'B000',
    name: 'Otros',
    description: 'Conceptos de ingreso no ubicados especificamente en los anteriores pero afines al grupo.',
    amount: 60,
    periodLabel: '2026-A',
  },
  {
    code: 'C000',
    groupCode: 'C000',
    name: 'Servicios generales',
    description: 'Agrupa los ingresos provenientes de la prestacion de servicios de caracter social a estudiantes y comunidad en general.',
    amount: 0,
    periodLabel: '2026-A',
  },
  {
    code: 'C001',
    groupCode: 'C000',
    name: 'Servicios medicos',
    description: 'Ingresos provenientes del pago de derechos al servicio medico del plantel, como examenes medicos, analisis clinicos y diagnosticos.',
    amount: 90,
    periodLabel: '2026-A',
  },
  {
    code: 'C002',
    groupCode: 'C000',
    name: 'Servicios a personas',
    description: 'Ingresos provenientes de la prestacion de servicios de comedor, higiene, limpieza y otros relacionados brindados a estudiantes y comunidad.',
    amount: 70,
    periodLabel: '2026-A',
  },
  {
    code: 'C003',
    groupCode: 'C000',
    name: 'Servicios de asesoria y orientacion',
    description: 'Ingresos provenientes de servicios de asesoria y orientacion en ramas como construccion, datos, editorial, impresion, fotocopiado y proyectos.',
    amount: 110,
    periodLabel: '2026-A',
  },
]

const sampleStudents = [
  {
    enrollmentNumber: '2407001001',
    curp: 'LOGA080101HCSPRLA1',
    firstName: 'Luis Omar',
    paternalLastName: 'Gomez',
    maternalLastName: 'Aguilar',
    addressLine: '2a poniente sur',
    neighborhood: 'Santa Teresita',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Marta Aguilar Diaz',
    guardianPhone: '9191000001',
  },
  {
    enrollmentNumber: '2407001002',
    curp: 'PEMR080214MCSLRBA2',
    firstName: 'Paola Elena',
    paternalLastName: 'Martinez',
    maternalLastName: 'Ruiz',
    addressLine: 'Av. Central Oriente S/N',
    neighborhood: 'Linda Vista',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Jose Martinez Cruz',
    guardianPhone: '9191000002',
  },
  {
    enrollmentNumber: '2407001003',
    curp: 'SACJ080320HCSNRRA3',
    firstName: 'Juan Carlos',
    paternalLastName: 'Sanchez',
    maternalLastName: 'Cruz',
    addressLine: 'Barrio Centro',
    neighborhood: 'Centro',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Juana Cruz Perez',
    guardianPhone: '9191000003',
  },
  {
    enrollmentNumber: '2407001004',
    curp: 'TOME080411MCSRRSA4',
    firstName: 'Maria Elena',
    paternalLastName: 'Torres',
    maternalLastName: 'Mendez',
    addressLine: 'Colonia San Pedro',
    neighborhood: 'San Pedro',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Rosa Mendez Lopez',
    guardianPhone: '9191000004',
  },
  {
    enrollmentNumber: '2407001005',
    curp: 'HEAN080505HCSRRDA5',
    firstName: 'Ana Sofia',
    paternalLastName: 'Hernandez',
    maternalLastName: 'Nunez',
    addressLine: 'Calle Principal',
    neighborhood: 'El Mirador',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Miguel Hernandez Santos',
    guardianPhone: '9191000005',
  },
  {
    enrollmentNumber: '2407001006',
    curp: 'CHBR080623HCSLPLA6',
    firstName: 'Brenda Lizeth',
    paternalLastName: 'Chavez',
    maternalLastName: 'Bautista',
    addressLine: 'Barrio Guadalupe',
    neighborhood: 'Guadalupe',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Luis Bautista Gomez',
    guardianPhone: '9191000006',
  },
  {
    enrollmentNumber: '2407001007',
    curp: 'VARE080714MCSRRNA7',
    firstName: 'Ricardo Emiliano',
    paternalLastName: 'Vazquez',
    maternalLastName: 'Ramos',
    addressLine: 'Privada Los Pinos',
    neighborhood: 'Los Pinos',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Maria Ramos Lopez',
    guardianPhone: '9191000007',
  },
  {
    enrollmentNumber: '2407001008',
    curp: 'DEKL080822HCSMNSA8',
    firstName: 'Karla Itzel',
    paternalLastName: 'Diaz',
    maternalLastName: 'Escobar',
    addressLine: 'Calle Reforma',
    neighborhood: 'San Antonio',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Patricia Escobar Diaz',
    guardianPhone: '9191000008',
  },
  {
    enrollmentNumber: '2407001009',
    curp: 'ROPM080930MCSLRSA9',
    firstName: 'Pedro Manuel',
    paternalLastName: 'Rodriguez',
    maternalLastName: 'Pinto',
    addressLine: 'Camino al Cobach',
    neighborhood: 'San Jose',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Teresa Pinto Ruiz',
    guardianPhone: '9191000009',
  },
  {
    enrollmentNumber: '2407001010',
    curp: 'MOGA081015HCSPRLA0',
    firstName: 'Gabriela Andrea',
    paternalLastName: 'Morales',
    maternalLastName: 'Ordonez',
    addressLine: 'Calle Hidalgo',
    neighborhood: 'San Sebastian',
    locality: 'Yajalon',
    municipality: 'Yajalon',
    state: 'Chiapas',
    schoolCycle: '2026-2027',
    academicStatus: 'Regular',
    guardianFullName: 'Andrea Ordonez Perez',
    guardianPhone: '9191000010',
  },
]

export async function ensureBaseData() {
  const controlEscolarUser = await prisma.user.findUnique({
    where: { username: 'control.escolar' },
  })

  if (!controlEscolarUser) {
    await prisma.user.create({
      data: {
        username: 'control.escolar',
        displayName: 'Usuario de Control Escolar',
        role: 'CONTROL_ESCOLAR',
      },
    })
  }

  const defaultUser = await prisma.user.findUnique({
    where: { username: 'ingresos.propios' },
  })

  if (!defaultUser) {
    await prisma.user.create({
      data: {
        username: 'ingresos.propios',
        displayName: 'Encargado de Ingresos Propios',
        role: 'INGRESOS_PROPIOS',
      },
    })
  }

  for (const concept of baseConcepts) {
    const existing = await prisma.chargeConcept.findUnique({
      where: { code: concept.code },
      include: { tariffs: { where: { isActive: true }, take: 1 } },
    })

    if (!existing) {
      await prisma.chargeConcept.create({
        data: {
          code: concept.code,
          groupCode: concept.groupCode,
          name: concept.name,
          description: concept.description,
          tariffs: {
            create: {
              amount: concept.amount,
              periodLabel: concept.periodLabel,
              isActive: true,
            },
          },
        },
      })
      continue
    }

    await prisma.chargeConcept.update({
      where: { id: existing.id },
      data: {
        groupCode: concept.groupCode,
        name: concept.name,
        description: concept.description,
      },
    })

    if (existing.tariffs.length === 0) {
      await prisma.chargeTariff.create({
        data: {
          conceptId: existing.id,
          amount: concept.amount,
          periodLabel: concept.periodLabel,
          isActive: true,
        },
      })
      continue
    }

    const activeTariff = existing.tariffs[0]
    if (Number(activeTariff.amount) === 0 && concept.amount > 0) {
      await prisma.chargeTariff.update({
        where: { id: activeTariff.id },
        data: {
          amount: concept.amount,
          periodLabel: concept.periodLabel,
        },
      })
    }
  }

  for (const student of sampleStudents) {
    const existingStudent = await prisma.student.findUnique({
      where: { enrollmentNumber: student.enrollmentNumber },
    })

    if (existingStudent) {
      continue
    }

    await prisma.student.create({
      data: {
        enrollmentNumber: student.enrollmentNumber,
        curp: student.curp,
        firstName: student.firstName,
        paternalLastName: student.paternalLastName,
        maternalLastName: student.maternalLastName,
        addressLine: student.addressLine,
        neighborhood: student.neighborhood,
        locality: student.locality,
        municipality: student.municipality,
        state: student.state,
        schoolCycle: student.schoolCycle,
        academicStatus: student.academicStatus,
        status: 'LISTO_PARA_COBRO',
        validatedAt: new Date(),
        validatedBy: 'CONTROL_ESCOLAR',
        guardian: {
          create: {
            fullName: student.guardianFullName,
            phone: student.guardianPhone,
          },
        },
      },
    })
  }
}
